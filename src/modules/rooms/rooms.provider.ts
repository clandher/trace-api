// RoomsProvider: Acceso a datos de rooms en Supabase
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config/index.js';

let _supabase: SupabaseClient | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

export class RoomsProvider {
  static async isUserAllowed(roomId: string, userId: string): Promise<boolean> {
    const supabase = getSupabase();
    const { data: room } = await supabase.from('rooms').select('host_user_id').eq('id', roomId).single();
    if (room?.host_user_id === userId) return true;
    const { data: invite } = await supabase.from('room_invites').select('id').eq('room_id', roomId).eq('user_id', userId).single();
    return !!invite;
  }
}
