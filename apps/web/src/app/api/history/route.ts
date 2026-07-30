import {
  resolveAuthenticatedPrincipal
} from "../../../server/authenticated-request.js";
import { getAppDatabase } from "../../../server/app-database.js";
import {
  createHistoryRouteHandlers
} from "../../../server/history-route.js";
import {
  createUserRepository
} from "../../../server/user-repository.js";

function createProductionDependencies() {
  return {
    resolvePrincipal: resolveAuthenticatedPrincipal,
    repository: createUserRepository(getAppDatabase().db)
  };
}

export async function GET(request: Request): Promise<Response> {
  return createHistoryRouteHandlers(
    createProductionDependencies()
  ).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return createHistoryRouteHandlers(
    createProductionDependencies()
  ).POST(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return createHistoryRouteHandlers(
    createProductionDependencies()
  ).DELETE(request);
}
