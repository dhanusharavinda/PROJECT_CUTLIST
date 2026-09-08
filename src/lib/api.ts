import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./tenancy";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Wraps a route handler so thrown HttpErrors become clean JSON responses and
 * unexpected errors never leak a stack trace to the client.
 */
export function route<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      if (err instanceof ZodError) {
        const first = err.errors[0];
        return NextResponse.json(
          {
            error: first
              ? `${first.path.join(".") || "input"}: ${first.message}`
              : "Invalid input.",
            issues: err.errors,
          },
          { status: 400 },
        );
      }
      console.error("[api]", err);
      return NextResponse.json(
        { error: "Something went wrong on our side." },
        { status: 500 },
      );
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body.");
  }
}
