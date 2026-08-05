import { redirect } from "next/navigation";

// /login is the address people (and the post-reset redirect) reach for; the
// sign-in screen itself lives at /sign-in, so keep one canonical page.
export default function LoginPage() {
  redirect("/sign-in");
}
