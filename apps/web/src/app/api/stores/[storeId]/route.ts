import {
  resolveAuthenticatedPrincipal
} from "../../../../server/authenticated-request.js";
import {
  getAppDatabase
} from "../../../../server/app-database.js";
import {
  createSqliteStoreDetailService,
  createStoreDetailRouteHandlers
} from "../../../../server/store-detail-service.js";

export const runtime = "nodejs";

interface StoreDetailRouteContext {
  params: Promise<{ storeId: string }>;
}

function createProductionDependencies() {
  const appDatabase = getAppDatabase();

  return {
    resolvePrincipal: resolveAuthenticatedPrincipal,
    service: createSqliteStoreDetailService(appDatabase)
  };
}

export async function GET(
  request: Request,
  context: StoreDetailRouteContext
): Promise<Response> {
  const { storeId } = await context.params;

  return createStoreDetailRouteHandlers(
    createProductionDependencies()
  ).GET(request, storeId);
}
