import { handleConvertRequest } from "@/lib/api/convert";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleConvertRequest(request);
}
