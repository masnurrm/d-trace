'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiClientError } from '@/lib/api/client';

interface FormMutationOptions<TValues extends FieldValues, TData> {
  mutationFn: (values: TValues) => Promise<TData>;
  /** react-hook-form's setter, so field-level API errors land on their field. */
  setError: UseFormSetError<TValues>;
  onSuccess?: (data: TData, values: TValues) => void | Promise<void>;
  /** Shown when the failure is not something the API described. */
  fallbackMessage?: string;
}

/**
 * The mutation result, plus the form-level message. An intersection rather
 * than an interface: UseMutationResult is a union discriminated on status,
 * and extending a union is not something an interface can do.
 */
export type FormMutation<TValues extends FieldValues, TData> = UseMutationResult<
  TData,
  Error,
  TValues
> & {
  /** The form-level message, or null when every error belongs to a field. */
  formError: string | null;
};

/**
 * The one way this app submits a form.
 *
 * Every form used to repeat the same block: clear the banner, try, map
 * `ApiClientError.details` onto the fields, fall back to a generic message.
 * That mapping is the part worth getting right once - a validation error the
 * API reports per field should appear on that field, not as a banner.
 */
export function useFormMutation<TValues extends FieldValues, TData = unknown>({
  mutationFn,
  setError,
  onSuccess,
  fallbackMessage = 'Server tidak dapat dihubungi. Coba lagi.',
}: FormMutationOptions<TValues, TData>): FormMutation<TValues, TData> {
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation<TData, Error, TValues>({
    mutationFn,
    onMutate: () => {
      setFormError(null);
    },
    onSuccess,
    onError: (error) => {
      if (error instanceof ApiClientError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as Path<TValues>, { message });
        }
        // A banner repeating what is already printed under a field is noise.
        setFormError(Object.keys(fieldErrors).length > 0 ? null : error.message);
        return;
      }
      setFormError(fallbackMessage);
    },
  });

  return { ...mutation, formError };
}
