import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'dtrace:isPublic';

/**
 * Opt a route out of the globally applied `JwtAuthGuard`.
 * Authentication is deny-by-default: forgetting this decorator locks a route
 * down, forgetting a guard does not open one up.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
