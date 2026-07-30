import {
  handlers as authHandlers
} from "../../../../auth.js";
import {
  createAuthRouteHandlers,
  type AuthRouteDelegate
} from "../../../../server/auth-route.js";

const routeHandlers = createAuthRouteHandlers({
  GET: authHandlers.GET as AuthRouteDelegate,
  POST: authHandlers.POST as AuthRouteDelegate
});

export const GET = routeHandlers.GET;
export const POST = routeHandlers.POST;
