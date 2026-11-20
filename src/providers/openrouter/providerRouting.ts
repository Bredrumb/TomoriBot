export interface OpenrouterProviderRouting {
  require_parameters: boolean;
}

// OpenRouter otherwise routes to endpoints that silently drop tools or response_format, so requiring parameter
// support makes dependent requests fail fast.
export function buildOpenrouterProviderRouting(options: {
  requiresParameterSupport: boolean;
}): OpenrouterProviderRouting | undefined {
  if (!options.requiresParameterSupport) {
    return undefined;
  }

  return {
    require_parameters: true,
  };
}
