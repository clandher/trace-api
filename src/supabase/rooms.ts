import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function isUserAllowed(roomId: string, userId: string): Promise<boolean> {
  // Verifica si el usuario es host o invitado de la sala
  const { data: room } = await supabase.from('rooms').select('host_user_id').eq('id', roomId).single();
  if (room?.host_user_id === userId) return true;
  const { data: invite } = await supabase.from('room_invites').select('id').eq('room_id', roomId).eq('user_id', userId).single();
  return !!invite;
}
