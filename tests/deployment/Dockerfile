FROM python:3.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0
RUN apk add --no-cache bash jq coreutils findutils util-linux gnupg sudo
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /repo
COPY deploy/hetzner/ deploy/hetzner/
COPY deploy/azure/ deploy/azure/
COPY tests/deployment/ tests/deployment/
CMD ["python3", "-B", "-m", "unittest", "discover", "-s", "tests/deployment", "-v"]
