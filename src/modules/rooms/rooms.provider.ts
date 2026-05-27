// RoomsProvider: Acceso a datos de rooms en Supabase
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config/index.js';


export class RoomsProvider {
  static async isUserAllowed(roomId: string, userId: string, userToken: string): Promise<boolean> {
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const { data: room } = await supabase.from('rooms').select('host_user_id').eq('id', roomId).single();
    if (room?.host_user_id === userId) return true;
    const { data: member } = await supabase.from('room_members').select('user_id').eq('room_id', roomId).eq('user_id', userId).maybeSingle();
    return !!member;
  }
}
