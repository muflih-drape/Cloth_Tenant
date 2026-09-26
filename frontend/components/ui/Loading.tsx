import { Spinner } from "./spinner";

interface PageLoadingProps {
    text?: string;
}

export function PageLoading({ text = "Loading…" }: PageLoadingProps) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-3">
            <Spinner className="h-12 w-12 text-primary" />
            {text && (
                <p className="text-lg text-gray-700 animate-pulse">{text}</p>
            )}
        </div>
    );
}
