export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-5 py-8">
      <div className="sk h-4 w-16" />
      <div className="sk mt-3 h-12 w-64" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="sk h-28" />
        <div className="sk h-28" />
        <div className="sk h-28" />
      </div>
      <div className="mt-6 grid gap-3">
        <div className="sk h-24" />
        <div className="sk h-24" />
        <div className="sk h-24" />
      </div>
    </div>
  );
}
