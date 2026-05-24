// Ejemplo de test para RoomsService
// Puedes usar Jest, Vitest, u otro framework
import { RoomsService } from '../src/modules/rooms/rooms.service.js';

describe('RoomsService', () => {
  it('debe retornar rooms y count', () => {
    const service = new RoomsService();
    const result = service.getActiveRooms();
    expect(result).toHaveProperty('rooms');
    expect(result).toHaveProperty('count');
  });
});