import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log('Testing Supabase Connection...');
  console.log('URL:', process.env.SUPABASE_URL);
  
  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, yjs_state')
    .limit(5);
    
  if (error) {
    console.error('Error selecting rooms:', error);
  } else {
    console.log('Select rooms success! Count:', data.length);
    for (const room of data) {
      console.log(`Room ID: ${room.id}, Name: ${room.name}, Has State: ${!!room.yjs_state}`);
    }
  }
}
test();
