export const sendChatMessage = async (message: string, userId: string, isCrew: boolean = false) => {
  const token = localStorage.getItem('jwt');
  const endpoint = isCrew ? '/api/crew-chat' : '/api/chat';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ message, user_id: userId }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return await res.json();
};

export const getMemories = async (userId: string) => {
  const token = localStorage.getItem('jwt');
  const res = await fetch(`/api/memories?user_id=${userId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load memories');
  return await res.json();
};

export const addMemory = async (content: string, userId: string) => {
  const token = localStorage.getItem('jwt');
  const res = await fetch(`/api/memories?user_id=${userId}`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ memory: content })
  });
  if (!res.ok) throw new Error('Failed to add memory');
  return await res.json();
};

export const deleteMemory = async (memoryId: string, userId: string) => {
  const token = localStorage.getItem('jwt');
  const res = await fetch(`/api/memories/${memoryId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete memory');
  return await res.json();
};
