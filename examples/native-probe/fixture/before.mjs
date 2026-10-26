export async function loadProfile(request) {
  try {
    const response = await request('/api/profile');
    if (!response.ok) throw new Error('Could not load the profile.');
    return { ok: true, data: await response.json() };
  } catch {
    return null;
  }
}
