import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen min-w-full flex flex-col items-center justify-center">
      <div className="text-center space-y-5">
        <h1 className="text-8xl font-bold text-primary">404</h1>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-heading">Page not found</h2>
          <p className="text-text text-xs max-w-60 mx-auto">
            This page does not exist!
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-md font-bold text-xs transition-all hover:brightness-110"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
