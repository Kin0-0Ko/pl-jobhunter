interface Props {
  message: string;
}

export function ErrorState({ message }: Props) {
  const is401 = message === '401';

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center max-w-md p-8">
        <div className="text-5xl mb-4">{is401 ? '🔒' : '⚠️'}</div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          {is401 ? 'Unauthorized' : 'Something went wrong'}
        </h1>
        <p className="text-gray-500 text-sm">
          {is401
            ? 'Invalid or missing API token. Check VITE_API_TOKEN in your .env file.'
            : `Error: ${message}`}
        </p>
      </div>
    </div>
  );
}
