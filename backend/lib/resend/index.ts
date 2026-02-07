import { Resend } from "resend";

let _resend: Resend | undefined;

function createResend(): Resend {
  if (process.env.IS_E2E) {
    return {
      emails: {
        send: async () => ({ data: { id: "mock-email-id" }, error: null }),
      },
    } as unknown as Resend;
  }
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY!);
  }
  return _resend;
}

export const resend = new Proxy({} as Resend, {
  get(_, prop) {
    const instance = createResend();
    return (instance as any)[prop];
  },
});
