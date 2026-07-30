import {
  parseHistoryDelete,
  parseHistoryMutation,
  parseHistoryQuery
} from "@bread-map/contracts";
import {
  apiErrorResponse,
  jsonError,
  readJsonBody,
  requireMutationOrigin
} from "./api-response.js";
import type { PrincipalResolver } from "./authenticated-request.js";
import type { createUserRepository } from "./user-repository.js";

type UserRepository = ReturnType<typeof createUserRepository>;

export interface HistoryRouteDependencies {
  resolvePrincipal: PrincipalResolver;
  repository: UserRepository;
}

export function createHistoryRouteHandlers(
  dependencies: HistoryRouteDependencies
) {
  return {
    async GET(request: Request): Promise<Response> {
      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        const url = new URL(request.url);
        const query = parseHistoryQuery(
          Object.fromEntries(url.searchParams.entries())
        );

        return Response.json({
          histories: dependencies.repository.listHistory(
            principal.userId,
            query
          )
        });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
    async POST(request: Request): Promise<Response> {
      const originFailure = requireMutationOrigin(request);
      if (originFailure !== null) {
        return originFailure;
      }

      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        const mutation = parseHistoryMutation(
          await readJsonBody(request)
        );
        const history = dependencies.repository.addHistory(
          principal.userId,
          mutation
        );

        return Response.json({ history }, { status: 201 });
      } catch (error) {
        return apiErrorResponse(error);
      }
    },
    async DELETE(request: Request): Promise<Response> {
      const originFailure = requireMutationOrigin(request);
      if (originFailure !== null) {
        return originFailure;
      }

      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        const deletion = parseHistoryDelete(
          await readJsonBody(request)
        );
        const deleted = dependencies.repository.deleteHistory(
          principal.userId,
          deletion
        );

        return deleted
          ? new Response(null, { status: 204 })
          : jsonError(404, "RESOURCE_NOT_FOUND");
      } catch (error) {
        return apiErrorResponse(error);
      }
    }
  };
}
