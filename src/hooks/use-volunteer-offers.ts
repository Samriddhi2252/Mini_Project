import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { VolunteerOffer, VolunteerOfferCategory } from '@/types';

interface OfferRow {
  id: string;
  category: VolunteerOfferCategory;
  title: string;
  details: string;
  quantity: string;
  contact_name: string;
  contact_phone: string;
  location: string;
  photo_path: string | null;
  status: VolunteerOffer['status'];
  created_at: string;
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LOCAL_STORAGE_KEY = 'resqlink-volunteer-offers-v1';

const INITIAL_OFFERS: VolunteerOffer[] = [
  {
    id: 'offer-init-1',
    category: 'water',
    title: '50 Drinking Water Crates & 100 ORS Packets',
    details: 'Available for immediate pickup or localized delivery near Mayur Vihar Phase 1 relief camp.',
    quantity: '50 crates, 100 ORS',
    contactName: 'Rohit Verma (East Delhi Volunteers)',
    contactPhone: '+91 98112 34567',
    location: 'Mayur Vihar Ph 1, East Delhi',
    photoPath: null,
    photoUrl: null,
    status: 'available',
    createdAt: Date.now() - 3600000 * 2,
  },
  {
    id: 'offer-init-2',
    category: 'food',
    title: '150 Fresh Cooked Meal Packets (Khichdi & Bananas)',
    details: 'Prepared fresh at community kitchen. Can supply to Yamuna Bazar or Geeta Colony shelter.',
    quantity: '150 meal boxes',
    contactName: 'Gurudwara Sewa Committee',
    contactPhone: '+91 98711 22334',
    location: 'Geeta Colony, Delhi',
    photoPath: null,
    photoUrl: null,
    status: 'available',
    createdAt: Date.now() - 3600000 * 5,
  },
  {
    id: 'offer-init-3',
    category: 'medical',
    title: 'First-Aid Kits, Sterile Bandages & Pain Relief',
    details: '2 Volunteer EMTs ready with sterile gauze, wound dressings, and basic medications.',
    quantity: '10 kits + 2 EMTs',
    contactName: 'Dr. Neha Kapoor',
    contactPhone: '+91 98990 11223',
    location: 'Laxmi Nagar, East Delhi',
    photoPath: null,
    photoUrl: null,
    status: 'available',
    createdAt: Date.now() - 3600000 * 8,
  },
];

function getStoredOffers(): VolunteerOffer[] {
  if (typeof window === 'undefined') return INITIAL_OFFERS;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(INITIAL_OFFERS));
      return INITIAL_OFFERS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_OFFERS;
  } catch {
    return INITIAL_OFFERS;
  }
}

function saveStoredOffers(offers: VolunteerOffer[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(offers));
  } catch (err) {
    console.warn('[useVolunteerOffers] Failed to persist offers to localStorage:', err);
  }
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    } catch {
      resolve(null);
    }
  });
}

function toOffer(row: OfferRow, photoUrl: string | null): VolunteerOffer {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    details: row.details,
    quantity: row.quantity,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    location: row.location,
    photoPath: row.photo_path,
    photoUrl,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  };
}

async function withPhotoUrl(row: OfferRow): Promise<VolunteerOffer> {
  if (!row.photo_path) return toOffer(row, null);
  try {
    const { data } = await supabase.storage.from('volunteer-offers').createSignedUrl(row.photo_path, 3600);
    return toOffer(row, data?.signedUrl ?? null);
  } catch {
    return toOffer(row, null);
  }
}

export function useVolunteerOffers() {
  const [offers, setOffers] = useState<VolunteerOffer[]>(() => getStoredOffers());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOffers = useCallback(async () => {
    const local = getStoredOffers();
    setOffers(local);

    if (!isSupabaseConfigured) {
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from('volunteer_offers')
        .select('id, category, title, details, quantity, contact_name, contact_phone, location, photo_path, status, created_at')
        .order('created_at', { ascending: false });

      if (queryError) {
        console.warn('[useVolunteerOffers] Supabase load failed, using local offers:', queryError);
        setError(null);
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as OfferRow[];
      const remoteOffers = await Promise.all(rows.map(withPhotoUrl));

      const mergedMap = new Map<string, VolunteerOffer>();
      remoteOffers.forEach((o) => mergedMap.set(o.id, o));
      local.forEach((o) => {
        if (!mergedMap.has(o.id)) mergedMap.set(o.id, o);
      });
      const merged = Array.from(mergedMap.values()).sort((a, b) => b.createdAt - a.createdAt);

      setOffers(merged);
      saveStoredOffers(merged);
      setError(null);
    } catch (err) {
      console.warn('[useVolunteerOffers] Network error loading offers; using local storage:', err);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  const createOffer = useCallback(async (input: {
    category: VolunteerOfferCategory;
    title: string;
    details: string;
    quantity: string;
    contactName: string;
    contactPhone: string;
    location: string;
    photo: File | null;
  }) => {
    // 1. Photo validation is applied ONLY when a photo is explicitly provided
    if (input.photo) {
      if (!ALLOWED_PHOTO_TYPES.includes(input.photo.type) || input.photo.size > MAX_PHOTO_BYTES) {
        throw new Error('Please choose a JPG, PNG, or WebP image under 5 MB.');
      }
    }

    // 2. Read local data URL if a photo file exists (safely skipped if null/empty)
    let localPhotoUrl: string | null = null;
    if (input.photo) {
      localPhotoUrl = await readFileAsDataUrl(input.photo);
    }

    // 3. Try Supabase backend if configured
    if (isSupabaseConfigured) {
      try {
        let photoPath: string | null = null;
        if (input.photo) {
          photoPath = `${crypto.randomUUID()}-${input.photo.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
          const { error: uploadError } = await supabase.storage
            .from('volunteer-offers')
            .upload(photoPath, input.photo, { contentType: input.photo.type, upsert: false });
          if (uploadError) {
            console.warn('[useVolunteerOffers] Remote photo upload failed, using local photo preview:', uploadError);
            photoPath = null;
          }
        }

        const { data, error: insertError } = await supabase
          .from('volunteer_offers')
          .insert({
            category: input.category,
            title: input.title.trim(),
            details: input.details.trim(),
            quantity: input.quantity.trim(),
            contact_name: input.contactName.trim(),
            contact_phone: input.contactPhone.trim(),
            location: input.location.trim(),
            photo_path: photoPath,
          })
          .select('id, category, title, details, quantity, contact_name, contact_phone, location, photo_path, status, created_at')
          .maybeSingle();

        if (!insertError && data) {
          const offer = await withPhotoUrl(data as OfferRow);
          if (!offer.photoUrl && localPhotoUrl) {
            offer.photoUrl = localPhotoUrl;
          }
          setOffers((current) => {
            const next = [offer, ...current];
            saveStoredOffers(next);
            return next;
          });
          return offer;
        } else {
          console.warn('[useVolunteerOffers] Supabase insert failed, saving to localStorage:', insertError);
        }
      } catch (backendErr) {
        console.warn('[useVolunteerOffers] Supabase exception, saving to localStorage:', backendErr);
      }
    }

    // 4. LocalStorage Fallback (works with or without photo, completely offline or without Supabase)
    const localOffer: VolunteerOffer = {
      id: `offer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: input.category,
      title: input.title.trim(),
      details: input.details.trim(),
      quantity: input.quantity.trim(),
      contactName: input.contactName.trim(),
      contactPhone: input.contactPhone.trim(),
      location: input.location.trim(),
      photoPath: null,
      photoUrl: localPhotoUrl,
      status: 'available',
      createdAt: Date.now(),
    };

    setOffers((current) => {
      const next = [localOffer, ...current];
      saveStoredOffers(next);
      return next;
    });

    return localOffer;
  }, []);

  return { offers, loading, error, createOffer, reload: loadOffers };
}
