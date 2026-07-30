import { ZodError } from "zod";
import { AUTH_ORIGIN } from "../auth-config.js";
import {
  StoreNotAvailableError,
  UserNotActiveError
} from "./user-repository.js";

export class InvalidJsonError extends Error {
  constructor() {
    super("invalid JSON");
    this.name = "InvalidJsonError";
  }
}

export function jsonError(
  status: number,
  code: string
): Response {
  return Response.json(
    {
      error: { code }
    },
    { status }
  );
}

export function requireMutationOrigin(
  request: Request
): Response | null {
  return request.headers.get("origin") === AUTH_ORIGIN
    ? null
    : jsonError(403, "ORIGIN_REQUIRED");
}

export async function readJsonBody(
  request: Request
): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonError();
  }
}

export function apiErrorResponse(error: unknown): Response {
  if (
    error instanceof InvalidJsonError ||
    error instanceof ZodError
  ) {
    return jsonError(400, "INVALID_REQUEST");
  }

  if (error instanceof UserNotActiveError) {
    return jsonError(401, "AUTHENTICATION_REQUIRED");
  }

  if (error instanceof StoreNotAvailableError) {
    return jsonError(404, "RESOURCE_NOT_FOUND");
  }

  return jsonError(500, "INTERNAL_ERROR");
}
