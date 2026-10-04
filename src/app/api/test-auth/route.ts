import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  const { user, error } = await getAuthenticatedUser(request);

  if (error) {
    return Response.json({ authenticated: false, error }, { status: 401 });
  }

  return Response.json({ authenticated: true, user_id: user?.id, email: user?.email });
}