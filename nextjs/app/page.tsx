import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">bisque-booking</h1>
        <p className="text-gray-600 mb-8">
          Schedule a time to connect.
        </p>
        <Link
          href="/book"
          className="inline-block bg-orange-500 text-white font-semibold px-8 py-3 rounded-lg hover:bg-orange-600 transition-colors"
        >
          Book a time
        </Link>
      </div>
    </main>
  );
}
