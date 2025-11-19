# TomoriBot AWS Deployment TODO List

**Target:** First production deployment on AWS Free Tier
**Timeline:** ~1 month (4 weeks)
**Project Status:** Hobby project MVP - focus on essentials, not overkill

---

## Priority Legend

- 🔴 **CRITICAL** - Must complete before AWS deployment (blocking)
- 🟠 **HIGH** - Should complete before public launch
- 🟡 **MEDIUM** - Nice to have for first deployment
- 🔵 **LOW** - Post-MVP enhancement (can defer)

---

## Week 1: AWS Foundation & Infrastructure

### 🔴 1. AWS Infrastructure Setup (3-4 days)
**Why First:** Everything else depends on having the AWS environment ready

- [x] **1.1** Set up AWS account with MFA on root account

MFA = Multi-Factor Authentication

- [x] **1.2** Create IAM user/role for deployment (least privilege)

IAM = Identity and Access Management, For creating a lesser admin user that isn't Root, for daily use

- [x] **1.3** Create VPC with private subnets

VPC (Virtual private Cloud)
  
  The VPC (10.0.0.0/16): The Perimeter Fence. Nothing gets in or out unless you allow it. It defines "Your Territory."
  Public Subnets: The Front Porch. It has a path to the street (Internet Gateway). We will put TomoriBot here so she can "shout" messages out to Discord.
  
  Private Subnets: The Safe Room. It has no door to the outside street. We will put your Database here. Hackers on the internet can't even try to connect to it because there is no path.
  
  Availability Zones (AZs): Separate Physical Buildings. If "Building A" (AZ1) loses power, your house in "Building B" (AZ2) stays lights-on.

  - Private subnet for application (ECS)

    ECS (Elastic Container Service) = ECS looks at your ECR locker, grabs the TomoriBot image, and runs it on a server. If TomoriBot crashes, ECS notices and restarts it.

    "ECS Fargate." = This is a "Serverless" mode for ECS. It means you tell AWS "Here is my container, just run it," and AWS finds a server for you. You don't have to manage the underlying Linux operating system or updates.

    Note: AWS regions differ by cost, switch to us-east-1 or ap-south-1 for cheapness
    
  - Private subnet for database (RDS)
  - Public subnet for NAT gateway (if needed)

- [x] **1.4** Configure Security Groups

If the VPC is the Fence around your house, Security Groups are the Bouncers standing at every door (Bot door, Database door). They check ID cards to decide who gets in.

We need to create two separate groups. This uses a "Chaining" technique which is a huge security win:

    The Bot's Group: Allows it to talk to Discord.

    The Database's Group: Only allows entry if the visitor is wearing the "Bot's Group" badge.

  - Bot SG: Outbound HTTPS only, PostgreSQL to DB

As for the no inbound rules of the "bot" group (TomoriBot), Wouldn't that affect how she interacts with the different APIs she uses? Such as OpenRouter, NovelAI, and/or Gemini which powers the bot's responses (depending on what the user configured her with)

And you say that the bot doesn't call the bot directly, but don't Discord slash commands or modal responses get sent to TomoriBot...?

The answer lies in two concepts: Stateful Firewalls and the Discord Gateway.

1. Why APIs (OpenRouter, NovelAI) still work

"I call you, so you can talk back." AWS Security Groups are "Stateful".

How it works: When TomoriBot sends a request out to OpenRouter (which we allowed), AWS remembers that specific conversation.

The Magic: When OpenRouter replies with the generated text, AWS sees the "return address" matches the request you just sent, and automatically opens the door for that specific answer.

Result: You don't need an open Inbound rule for replies.

2. Why Discord Slash Commands still work

"The Bot calls Discord, not the other way around." Most Discord bots (especially discord.js/Python bots) run on a Gateway Connection (WebSocket).

The Process: When TomoriBot starts up, she effectively "dials" Discord's server and says, "I'm here! Keep this line open."

Slash Commands: When a user types /hello, Discord sends that command down the already open wire that TomoriBot established.

Result: **Since TomoriBot initiated the call, it counts as "Outbound" traffic.**
  - DB SG: Inbound PostgreSQL from bot only
- [x] **1.5** Set up RDS PostgreSQL instance

This is the most complex step because we have to connect three different pieces:

    Subnet Group: To force the DB into the "Private" safe room.

    Parameter Group: To force SSL encryption (Security requirement).

    The Database Itself: The actual PostgreSQL engine.
  - Enable encryption at rest
  - Enable automated backups (1 day retention)
  - Configure in private subnet
  - **Enable SSL/TLS enforcement** (force_ssl parameter)
SSL (Secure Sockets Layer) puts that postcard inside a locked, steel envelope.

Encryption: Even if someone intercepts the message, they only see scrambled garbage (ciphertext).

Why Force it? By setting rds.force_ssl = 1, you tell the database: "If someone tries to send me a naked postcard, burn it immediately." It prevents you (or a buggy version of TomoriBot) from accidentally connecting insecurely.

- [x] **1.6** Set up ECR (Elastic Container Registry) for Docker images

ECR (The "Code Garage") We need a place to park your bot's "Image" (the packaged version of your code) before it runs.
**Deliverable:** Working AWS infrastructure, no application deployed yet
**Reference:** `security-review/4_urgent_vulnerabilities.md` sections 3, 4

---

### 🔴 2. AWS Secrets Manager Migration (1-2 days)
**Why Second:** Need secrets in place before deploying application

- [x] **2.1** Create secrets in AWS Secrets Manager
  - `tomoribot/production` (just one secret as multiple parsable key-value pairs to save costs)
  - Any MCP API keys (if used)
- [x] **2.2** Update `src/utils/security/secretsManager.ts`
  - Implement `getSecret()` function using AWS SDK
  - Add fallback to env vars for local development
  - Update `getSecretOrEnv()` helper
- [x] **2.3** Update `src/index.ts` to use Secrets Manager in production
  ```typescript
  // Example
  const discordToken = await getSecretOrEnv('tomoribot/production', 'DISCORD_TOKEN');
  ```
- [ ] **2.4** Update IAM role to grant `secretsmanager:GetSecretValue` permission
- [ ] **2.5** Test locally with AWS CLI credentials

**Deliverable:** Application can fetch secrets from AWS Secrets Manager
**Reference:** `security-review/4_urgent_vulnerabilities.md` section 2

---

### 🔴 3. Database SSL/TLS Enforcement (1 day)
**Why Third:** Builds on RDS setup, required for secure connections

- [ ] **3.1** Update `src/index.ts` database connection logic
  ```typescript
  // Force SSL in production, prefer in development
  const sslMode = process.env.NODE_ENV === 'production' ? 'require' : 'prefer';
  ```
- [ ] **3.2** Configure RDS parameter group with `rds.force_ssl = 1`
- [ ] **3.3** Test database connection with SSL enabled
- [ ] **3.4** Verify SSL is working (check PostgreSQL logs)

**Deliverable:** Database connections are encrypted in transit
**Reference:** `security-review/4_urgent_vulnerabilities.md` section 4

---

## Week 2: CI/CD Security & Deployment Pipeline

### 🔴 4. Add Security Scanning to CI/CD (2-3 days)
**Why Fourth:** Catch vulnerabilities before they reach production

Currently: 15% security coverage (see `security-review/WORKFLOW_ANALYSIS.md`)
Target: 80%+ coverage

- [ ] **4.1** Add SAST scanning (Semgrep)
  - Create job in `.github/workflows/deploy-tomoribot.yml`
  - Configure for TypeScript and security rules
  - Block deployment on critical findings
- [ ] **4.2** Add dependency scanning (Snyk or npm audit)
  - Scan `package.json` and `bun.lock`
  - Alert on high/critical CVEs
  - Consider auto-updating patch versions
- [ ] **4.3** Add secret scanning (TruffleHog)
  - Scan full git history
  - Block commits with exposed secrets
  - Configure custom patterns (Discord tokens, API keys)
- [ ] **4.4** Add container scanning (Trivy)
  - Scan Docker image after build
  - Fail on high/critical vulnerabilities
  - Generate vulnerability report
- [ ] **4.5** Create security gate job
  - Requires all security scans to pass
  - Deployment depends on this gate

**Deliverable:** Security scans run automatically on every commit
**Reference:** `security-review/4_urgent_vulnerabilities.md` section 1, `security-review/WORKFLOW_ANALYSIS.md`

---

### 🔴 5. AWS Deployment Workflow (2 days)
**Why Fifth:** Need secure deployment process to AWS

Create **separate workflow** for AWS (keep existing self-hosted for development)

- [ ] **5.1** Create `.github/workflows/deploy-aws.yml`
  - Trigger on: push to `main`, manual dispatch
  - Use GitHub-hosted runners (ubuntu-latest)
  - Use OIDC for AWS authentication (no long-lived credentials)
- [ ] **5.2** Add pre-deployment checks
  - Verify security scans passed
  - Check AWS budget/costs
- [ ] **5.3** Implement ECS deployment
  - Build and push to ECR
  - Update ECS task definition
  - Deploy to ECS Fargate
- [ ] **5.4** Add post-deployment verification
  - Check ECS service health
  - Verify tasks are running
  - Check CloudWatch logs for errors
- [ ] **5.5** Set up ECS cluster and service
  - Create ECS cluster
  - Create task definition with proper resource limits
  - Create service with desired count = 1

**Deliverable:** Automated deployment to AWS ECS
**Reference:** `security-review/5_cicd_enhancements.md` section 5

---

### 🔴 6. Basic Monitoring & Cost Alerts (1-2 days)
**Why Sixth:** Critical for hobby project to avoid surprise bills

- [ ] **6.1** Set up AWS Budget Alerts
  - Alert at 50% of $10/month threshold
  - Alert at 80% of threshold
  - Alert at 100% of threshold
  - Email notifications to admin
- [ ] **6.2** Create CloudWatch Alarms (critical only)
  - ECS task failure alarm
  - High CPU usage (>80%)
  - High memory usage (>85%)
  - Database connection failures
- [ ] **6.3** Set up SNS topic for alerts
  - Email subscription for critical alerts
  - Consider Discord webhook for notifications
- [ ] **6.4** Create daily cost monitoring workflow
  - Check daily AWS costs
  - Alert if approaching free tier limits
  - Track which services are costing most

**Deliverable:** Email alerts for high costs and system failures
**Reference:** `security-review/4_urgent_vulnerabilities.md` section 5, `security-review/5_cicd_enhancements.md` section 6

---

## Week 3: Launch Readiness

### 🟠 7. Rate Limiting Enhancements (1-2 days)
**Why Seventh:** Prevent abuse and API cost explosions

Current: Per-user cooldown exists ✅
Needed: Global limits and circuit breakers

- [ ] **7.1** Implement global rate limiter
  - Max 100 requests/minute per user across all commands
  - Store in memory (acceptable for single instance)
  - Log violations to CloudWatch
- [ ] **7.2** Add circuit breaker for AI providers
  - Track failure rates for Gemini, NovelAI, OpenRouter
  - Open circuit after 5 consecutive failures
  - Auto-recover after 1 minute
  - Return user-friendly error when circuit open
- [ ] **7.3** Add API cost tracking
  - Log each AI API call with estimated cost
  - Daily summary of API usage
  - Alert if daily cost exceeds threshold

**Deliverable:** Protection against API abuse and cost spikes
**Reference:** `security-review/4_urgent_vulnerabilities.md` section 7, `security-review/2_attack_vectors.md`

---

### 🟠 8. Backup Verification & Restore Testing (1 day)
**Why Eighth:** RDS backups enabled, but need to verify they work

- [ ] **8.1** Verify RDS automated backups are enabled
  - 7-day retention configured
  - Backup window set (e.g., 3-4 AM UTC)
  - Point-in-time recovery enabled
- [ ] **8.2** Test restore procedure
  - Create test snapshot
  - Restore to new RDS instance
  - Verify data integrity
  - Document restore time
  - Delete test instance
- [ ] **8.3** Document backup/restore procedures
  - When to use snapshots vs point-in-time recovery
  - Step-by-step restore guide
  - Recovery time objectives (RTO)
  - Recovery point objectives (RPO)

**Deliverable:** Verified backup strategy, documented restore process
**Reference:** `security-review/4_urgent_vulnerabilities.md` section 6

---

### 🟠 9. Privacy Policy & Terms of Service (1-2 days)
**Why Ninth:** Legal requirement, shows users we care about privacy

- [ ] **9.1** Create privacy policy document
  - What data is collected (user IDs, server IDs, messages, memories)
  - How data is used (personalization, AI responses)
  - Data retention (indefinite unless user deletes)
  - User rights (export, delete, opt-out)
  - Third-party integrations (Discord, AI providers)
  - Contact information
- [ ] **9.2** Create simple Terms of Service
  - Bot is provided "as-is" for hobby use
  - No guarantees of uptime
  - Users responsible for their API keys
  - Right to modify/terminate service
- [ ] **9.3** Add `/privacy` command
  - Display privacy policy summary
  - Link to full policy (if hosting website)
  - Remind users of `/data export` and `/data delete` commands
- [ ] **9.4** Add bot status message with policy link

**Deliverable:** Privacy policy accessible via bot, compliant with GDPR basics
**Reference:** `security-review/3_security_recommendations.md` section 8.1

---

### 🟡 10. Basic Incident Response Documentation (1 day)
**Why Tenth:** Be prepared for when things go wrong

- [ ] **10.1** Create incident response runbook (Markdown doc)
  - What to do if bot goes offline
  - What to do if database is compromised
  - What to do if Discord token is leaked
  - What to do if AWS costs spike
  - What to do if API keys are exposed
- [ ] **10.2** Document emergency contacts
  - Who to notify for different incident types
  - Escalation procedures
- [ ] **10.3** Create rollback procedure
  - How to quickly revert to previous ECS task definition
  - How to restore database from backup
  - How to rotate compromised secrets
- [ ] **10.4** Add emergency shutdown procedure
  - How to stop ECS tasks quickly
  - How to disable bot without full shutdown

**Deliverable:** Clear incident response procedures documented
**Reference:** `security-review/2_attack_vectors.md` section on Incident Response

---

## Week 4: Testing, Polish & Launch

### 🟡 11. Pre-Launch Testing (2-3 days)

- [ ] **11.1** Test full deployment pipeline end-to-end
  - Trigger deployment from GitHub
  - Verify security scans run
  - Confirm ECS deployment succeeds
  - Check bot comes online in Discord
- [ ] **11.2** Load testing (basic)
  - Send multiple messages rapidly
  - Verify rate limiting works
  - Check memory/CPU usage stays reasonable
  - Monitor CloudWatch metrics
- [ ] **11.3** Security verification
  - Confirm secrets only in AWS Secrets Manager
  - Verify database uses SSL
  - Check security group rules are restrictive
  - Run manual vulnerability scan (basic)
- [ ] **11.4** Cost verification
  - Monitor AWS costs for test deployments
  - Ensure staying within free tier
  - Verify cost alerts work

**Deliverable:** Confidence that system works in production environment

---

### 🟡 12. Documentation & Launch Prep (1-2 days)

- [ ] **12.1** Update README with AWS deployment info
  - Prerequisites (AWS account, Bun, etc.)
  - Deployment instructions
  - Cost estimates
  - Monitoring guidance
- [ ] **12.2** Create deployment checklist
  - Pre-deployment verification steps
  - Post-deployment validation steps
  - Rollback procedures
- [ ] **12.3** Set up user-facing documentation
  - How to add bot to server
  - Basic usage guide
  - Privacy policy link
  - Support/feedback contact
- [ ] **12.4** Prepare launch announcement
  - Discord server announcement (if applicable)
  - GitHub release notes
  - Changelog

**Deliverable:** Complete documentation for deployment and usage

---

### 🟢 13. Launch! (1 day)

- [ ] **13.1** Final pre-launch checklist review
- [ ] **13.2** Deploy to production
- [ ] **13.3** Monitor closely for first 24-48 hours
- [ ] **13.4** Be ready to rollback if issues occur
- [ ] **13.5** Announce launch (gradually)

**Deliverable:** TomoriBot live on AWS! 🎉

---

## Post-MVP Enhancements (Defer until after launch)

These are important but **NOT required** for first deployment. Implement based on user feedback and actual demand.

### 🔵 14. Enhanced Logging & Monitoring (P2 - Medium Priority)
**Reference:** `security-review/3_security_recommendations.md` section 1

- [ ] Structured security event logging
- [ ] Request correlation IDs
- [ ] Prometheus metrics collection
- [ ] Grafana dashboards

**Why Defer:** Basic CloudWatch monitoring is sufficient for MVP with no users

---

### 🔵 15. Prompt Injection Protection (P1 - High Priority, but can launch without)
**Reference:** `security-review/3_security_recommendations.md` section 2.2

- [ ] Implement `PromptGuard` class
- [ ] Detect common injection patterns
- [ ] Sanitize user prompts before sending to AI
- [ ] Log suspicious prompts

**Why Defer:** Low risk for hobby project, can add once there's actual abuse

---

### 🔵 16. Advanced Input Validation (P2 - Medium Priority)
**Reference:** `security-review/3_security_recommendations.md` section 2

- [ ] Content security filtering
- [ ] URL validation and sanitization
- [ ] Anomaly detection for user inputs

**Why Defer:** Current validation is adequate, enhance based on abuse patterns

---

### 🔵 17. Role-Based Access Control (P2 - Medium Priority)
**Reference:** `security-review/3_security_recommendations.md` section 3.1

- [ ] Granular permissions system
- [ ] Premium user tier support
- [ ] Per-server role configuration

**Why Defer:** Current permission checks work, enhance when monetization is considered

---

### 🔵 18. Data Classification & Anonymization (P2 - Medium Priority)
**Reference:** `security-review/3_security_recommendations.md` section 4

- [ ] Data classification system
- [ ] Anonymization for analytics
- [ ] Automated retention policies

**Why Defer:** Good practice but not critical for hobby project with small user base

---

### 🔵 19. Advanced Network Security (P3 - Low Priority)
**Reference:** `security-review/3_security_recommendations.md` section 5

- [ ] Multi-layer VPC architecture
- [ ] WAF (if web interface added)
- [ ] DDoS protection (AWS Shield)

**Why Defer:** Free tier doesn't justify this complexity, basic VPC is sufficient

---

### 🔵 20. Penetration Testing & Security Audits (P2 - Medium Priority)
**Reference:** `security-review/3_security_recommendations.md` section 7.3

- [ ] Automated vulnerability scanning (OWASP ZAP)
- [ ] Manual penetration testing
- [ ] External security audit

**Why Defer:** Expensive and time-consuming, better after product-market fit

---

### 🔵 21. Advanced Availability Features (P2 - Medium Priority)
**Reference:** `security-review/3_security_recommendations.md` section 9

- [ ] Multi-AZ deployment
- [ ] Read replicas for database
- [ ] Auto-scaling based on load
- [ ] Graceful degradation modes

**Why Defer:** Single instance is fine for hobby project, over-engineering for current scale

---

### 🔵 22. Compliance & Governance (P2-P3 - Medium-Low Priority)
**Reference:** `security-review/3_security_recommendations.md` section 10

- [ ] Security training for contributors
- [ ] Security changelog
- [ ] Vulnerability disclosure policy
- [ ] Bug bounty program

**Why Defer:** Good for mature projects with many contributors/users, overkill for MVP

---

## Summary: What's In vs Out for MVP

### ✅ IN SCOPE (Must Have for First Deployment)
1. AWS Infrastructure (VPC, RDS, ECS)
2. AWS Secrets Manager
3. Database SSL/TLS
4. CI/CD security scanning (SAST, dependencies, secrets, containers)
5. Basic monitoring & cost alerts
6. Rate limiting & circuit breakers
7. Verified backups
8. Privacy policy
9. Incident response plan
10. Testing & documentation

**Total Effort:** ~4 weeks for one person working part-time

---

### ❌ OUT OF SCOPE (Post-MVP)
- Advanced logging/metrics
- Prompt injection protection (add if abused)
- Advanced input validation
- RBAC/premium features
- Data anonymization
- Advanced network security
- Penetration testing
- Multi-AZ/auto-scaling
- Security training programs

**Rationale:** These are valuable but not blocking for a hobby project MVP. Add them based on:
- Actual abuse patterns (prompt injection, input attacks)
- User growth (need for scaling)
- Revenue/monetization (justify security investment)
- Community contributions (need for governance)

---

## Quick Reference: Critical Path

**Week 1:** AWS setup → Secrets Manager → Database SSL
**Week 2:** Security scanning → AWS deployment → Monitoring
**Week 3:** Rate limiting → Backup testing → Privacy policy
**Week 4:** Testing → Documentation → Launch

**Minimum Viable Security:** Items 1-10 ✅
**Nice to Have:** Items 11-12 ⭐
**Post-Launch:** Items 14-22 📅

---

## Success Criteria

Before launching, verify:
- [x] All security scans pass (no critical vulnerabilities)
- [x] Secrets only in AWS Secrets Manager
- [x] Database uses SSL/TLS
- [x] Cost alerts configured and tested
- [x] Backups verified and restore tested
- [x] Rate limiting prevents abuse
- [x] Privacy policy accessible
- [x] Incident response documented
- [x] Full deployment tested end-to-end

If all ✅, you're ready to launch! 🚀

---

## Notes

- **Philosophy:** Ship an MVP that's secure enough for a hobby project, not enterprise-grade
- **Iterate:** Add security features based on actual usage and threats
- **Monitor:** Watch costs and metrics closely in first month
- **Be Ready:** Have rollback plan ready, expect to find issues
- **Communicate:** Be transparent about hobby status in privacy policy

Good luck with the deployment! 🎉
