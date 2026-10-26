export async function loadProfile(request) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request('/api/profile');
      if (!response.ok) throw new Error('Could not load the profile.');
      return { ok: true, data: await response.json() };
    } catch (error) {
      if (attempt === 2) {
        return { ok: false, error: error.message };
      }
    }
  }
}
