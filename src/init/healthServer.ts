import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { log } from "@/utils/misc/logger";
import { healthTracker } from "@/utils/misc/healthTracker";
import { eventLoopMonitor } from "@/utils/misc/eventLoopMonitor";

interface HealthServerRouteContext {
  requestUrl: URL;
}

type HealthServerRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: HealthServerRouteContext,
) => void | Promise<void>;

export interface HealthServerRoute {
  method: string;
  path: string;
  handler: HealthServerRouteHandler;
}

const registeredRoutes = new Map<string, HealthServerRoute>();

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

// Route registry stays exported because optional modules register HTTP routes here even when the base installation
// adds none.
export function registerHealthServerRoute(route: HealthServerRoute): void {
  registeredRoutes.set(routeKey(route.method, route.path), {
    ...route,
    method: route.method.toUpperCase(),
  });
}

// Health server must bind before other init steps so Cloud Run's startup probe finds the port open while returning
// 503 until Discord is ready.
export function startHealthServer(port: number): void {
  // Started here rather than with the post-ready timers so the series covers startup, which is when
  // the working set is established and when a stall would otherwise look like slow boot.
  eventLoopMonitor.start();

  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
      const healthStatus = healthTracker.getHealthStatus();
      const statusCode = healthStatus.healthy ? 200 : 503;

      // Exclude eventLoop from the 503 verdict because Compose curl -f healthchecks lack a calibrated lag threshold.
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: healthStatus.healthy ? "healthy" : "unhealthy",
          reason: healthStatus.reason,
          discord: {
            connected: healthStatus.details.clientReady,
            websocketPing: healthStatus.details.websocketPing,
            timeSinceLastActivity: healthStatus.details.timeSinceLastActivity,
            shards: healthStatus.details.shards,
            shardCount: healthStatus.details.shardCount,
            ...healthTracker.getConnectionState(),
          },
          eventLoop: eventLoopMonitor.getSnapshot(),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return;
    }
    const registeredRoute = registeredRoutes.get(routeKey(req.method ?? "GET", requestUrl.pathname));
    if (registeredRoute) {
      // Set for every registered route because a framed sign-in confirmation page could be clickjacked.
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      void Promise.resolve()
        .then(() => registeredRoute.handler(req, res, { requestUrl }))
        .catch((error) => {
          void log.error("Health server route handler failed", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal Server Error");
          } else {
            res.destroy();
          }
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(port, "0.0.0.0", () => {
    log.success(`Health check server listening on http://0.0.0.0:${port}/health`);
  });

  server.on("error", (error) => {
    log.error("Health check server error", error);
    if (!server.listening && registeredRoutes.size > 0) {
      log.warn(
        `Registered HTTP routes are unreachable because port ${port} could not be bound; set PORT to a free port`,
        undefined,
        { metadata: { routes: [...registeredRoutes.keys()] } },
      );
    }
  });
}
