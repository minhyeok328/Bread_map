import {
  resolveAuthenticatedPrincipal
} from "../../../server/authenticated-request.js";
import {
  createAccountRouteHandlers,
  type AccountRouteDependencies
} from "../../../server/account-route.js";
import { getAppDatabase } from "../../../server/app-database.js";
import {
  unlinkKakaoAccount
} from "../../../server/kakao-unlink.js";
import {
  createUserRepository
} from "../../../server/user-repository.js";

function createProductionDependencies(): AccountRouteDependencies {
  return {
    resolvePrincipal: resolveAuthenticatedPrincipal,
    repository: createUserRepository(getAppDatabase().db),
    unlink(accessToken) {
      return unlinkKakaoAccount({ accessToken });
    }
  };
}

export async function DELETE(request: Request): Promise<Response> {
  return createAccountRouteHandlers(
    createProductionDependencies()
  ).DELETE(request);
}
