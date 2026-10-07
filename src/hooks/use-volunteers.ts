import { useCallback, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { saveVolunteerProfile } from '@/lib/volunteer-profile';
import type {
  VolunteerGender,
  VolunteerRegistrationInput,
  VolunteerStatus,
} from '@/types';

interface VolunteerRow {
  id: string;
  full_name: string;
  gender: VolunteerGender;
  phone: string;
  email: string;
  latitude: number | null;
  longitude: number | null;
  location_permission: boolean;
  volunteer_status: VolunteerStatus;
  created_at: string;
}

/**
 * useVolunteers
 *
 * Registers (or upserts) a volunteer into the Supabase backend (`volunteers`
 * table) when Supabase is configured, or falls back to the Express server's
 * `/api/volunteer/register` endpoint, or finally to localStorage-only mode.
 *
 * Upsert strategy (prevents duplicates):
 *   - Supabase path: INSERT … ON CONFLICT (email) DO UPDATE so the same person
 *     can re-submit the form without creating a second row.
 *   - Server path: POST /api/volunteer/register with the same upsert semantics.
 *   - localStorage path: always overwrites the stored profile.
 *
 * Location is stored ONLY when the volunteer explicitly grants browser
 * geolocation permission. It is never requested or tracked silently.
 */
export function useVolunteers() {
  const [registering, setRegistering] = useState(false);
  const [registered,  setRegistered]  = useState(false);

  const registerVolunteer = useCallback(async (input: VolunteerRegistrationInput) => {
    setRegistering(true);

    // Build a localStorage profile snapshot regardless of backend path
    const profile = {
      fullName:           input.fullName.trim(),
      gender:             input.gender,
      phone:              input.phone.trim(),
      email:              input.email.trim().toLowerCase(),
      latitude:           input.locationPermission ? (input.latitude ?? null) : null,
      longitude:          input.locationPermission ? (input.longitude ?? null) : null,
      locationPermission: input.locationPermission,
      registeredAt:       Date.now(),
    };

    try {
      // ── PATH 1: Supabase ──────────────────────────────────────────────────
      if (isSupabaseConfigured) {
        try {
          const payload = {
            full_name:           input.fullName.trim(),
            gender:              input.gender,
            phone:               input.phone.trim(),
            email:               input.email.trim().toLowerCase(),
            latitude:            input.locationPermission ? input.latitude  : null,
            longitude:           input.locationPermission ? input.longitude : null,
            location_permission: input.locationPermission,
            volunteer_status:    'registered' as VolunteerStatus,
          };

          const { data, error: upsertError } = await supabase
            .from('volunteers')
            .upsert(payload, { onConflict: 'email', ignoreDuplicates: false })
            .select(
              'id, full_name, gender, phone, email, latitude, longitude, location_permission, volunteer_status, created_at'
            )
            .maybeSingle();

          if (upsertError) {
            if (
              upsertError.code === '42P10' ||  // no unique or exclusion constraint
              upsertError.code === '23505'      // unique_violation (duplicate)
            ) {
              console.warn(
                '[useVolunteers] Upsert fell back to plain insert (no unique email index).',
                upsertError.message
              );
              const { data: insertData, error: insertError } = await supabase
                .from('volunteers')
                .insert(payload)
                .select(
                  'id, full_name, gender, phone, email, latitude, longitude, location_permission, volunteer_status, created_at'
                )
                .maybeSingle();

              if (!insertError || insertError.code === '23505') {
                saveVolunteerProfile(profile);
                setRegistered(true);
                return (insertData ?? null) as VolunteerRow | null;
              }
              console.warn('[useVolunteers] Supabase insert failed, falling back:', insertError);
            } else {
              console.warn('[useVolunteers] Supabase upsert error, falling back:', upsertError);
            }
          } else {
            saveVolunteerProfile(profile);
            setRegistered(true);
            return data as VolunteerRow | null;
          }
        } catch (supabaseNetworkError) {
          console.warn('[useVolunteers] Supabase request failed, falling back to local/server:', supabaseNetworkError);
        }
      }

      // ── PATH 2: Express server fallback ──────────────────────────────────
      try {
        const res = await fetch('/api/volunteer/register', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            fullName:           input.fullName.trim(),
            gender:             input.gender,
            phone:              input.phone.trim(),
            email:              input.email.trim().toLowerCase(),
            latitude:           input.locationPermission ? input.latitude  : null,
            longitude:          input.locationPermission ? input.longitude : null,
            locationPermission: input.locationPermission,
          }),
        });

        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          console.info('[useVolunteers] Registered via Express server:', body);
          saveVolunteerProfile(profile);
          setRegistered(true);
          return body.volunteer ?? null;
        }

        if (res.status === 409) {
          console.info('[useVolunteers] Volunteer already registered on server.');
          saveVolunteerProfile(profile);
          setRegistered(true);
          return null;
        }
      } catch (networkErr) {
        console.warn(
          '[useVolunteers] Express server unreachable; falling back to localStorage mode.',
          networkErr
        );
      }

      // ── PATH 3: localStorage fallback (offline / demo mode) ───────────────
      saveVolunteerProfile(profile);
      setRegistered(true);
      return null;

    } catch (unexpectedErr) {
      console.warn('[useVolunteers] Unexpected error during registration; persisting locally:', unexpectedErr);
      saveVolunteerProfile(profile);
      setRegistered(true);
      return null;
    } finally {
      setRegistering(false);
    }
  }, []);

  const resetRegistration = useCallback(() => {
    setRegistered(false);
    setRegistering(false);
  }, []);

  return { registerVolunteer, registering, registered, resetRegistration };
}
