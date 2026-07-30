import { parseFavoriteMutation } from "@bread-map/contracts";
import {
  apiErrorResponse,
  jsonError,
  readJsonBody,
  requireMutationOrigin
} from "./api-response.js";
import type { PrincipalResolver } from "./authenticated-request.js";
import type { createUserRepository } from "./user-repository.js";

type UserRepository = ReturnType<typeof createUserRepository>;

export interface FavoriteRouteDependencies {
  resolvePrincipal: PrincipalResolver;
  repository: UserRepository;
}

export function createFavoriteRouteHandlers(
  dependencies: FavoriteRouteDependencies
) {
  return {
    async GET(request: Request): Promise<Response> {
      const principal =
        await dependencies.resolvePrincipal(request);
      if (principal === null) {
        return jsonError(401, "AUTHENTICATION_REQUIRED");
      }

      try {
        return Response.json({
          favorites: dependencies.repository.listFavorites(
            principal.userId
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
        const mutation = parseFavoriteMutation(
          await readJsonBody(request)
        );
        const result = dependencies.repository.addFavorite(
          principal.userId,
          mutation.storeId
        );
        if (result === null) {
          return jsonError(404, "RESOURCE_NOT_FOUND");
        }

        return Response.json(
          { favorite: result.favorite },
          { status: result.created ? 201 : 200 }
        );
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
        const mutation = parseFavoriteMutation(
          await readJsonBody(request)
        );
        const deleted = dependencies.repository.removeFavorite(
          principal.userId,
          mutation.storeId
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
