import {
  resolveAuthenticatedPrincipal
} from "../../../server/authenticated-request.js";
import {
  getAppDatabase
} from "../../../server/app-database.js";
import {
  createSqliteStoreSearchService,
  createStoreSearchRouteHandlers
} from "../../../server/search-service.js";

export const runtime = "nodejs";

function createProductionDependencies() {
  const appDatabase = getAppDatabase();

  return {
    resolvePrincipal: resolveAuthenticatedPrincipal,
    service: createSqliteStoreSearchService(appDatabase)
  };
}

export async function POST(request: Request): Promise<Response> {
  return createStoreSearchRouteHandlers(
    createProductionDependencies()
  ).POST(request);
}
