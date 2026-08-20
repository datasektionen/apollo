import { BrandWordmark } from './BrandLogo';

function HostedLogin({
  onSsoLogin,
  loading = false,
  error = '',
}) {
  return (
    <div className="h-full flex items-center justify-center bg-gray-900 text-white p-6">
      <div className="w-full max-w-sm space-y-6">
        <BrandWordmark className="mx-auto h-12" />
        <div className="w-full rounded-lg border border-gray-700 bg-gray-800 p-6 space-y-4">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-gray-300">
              Sign in with your organization account. If Apollo has no admin yet, the first eligible SSO user becomes the primary admin automatically.
            </p>
          </div>

          <button
            type="button"
            onClick={onSsoLogin}
            disabled={loading}
            className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-3 py-2 text-sm font-medium"
          >
            {loading ? 'Redirecting...' : 'Sign in with SSO'}
          </button>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default HostedLogin;
