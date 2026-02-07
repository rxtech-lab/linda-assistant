import { Resend } from "resend";

let _resend: Resend | undefined;

export const resend = new Proxy({} as Resend, {
  get(_, prop) {
    if (!_resend) {
      _resend = new Resend(process.env.RESEND_API_KEY!);
    }
    return (_resend as any)[prop];
  },
});
