// Surfaces the server's { error } message instead of a bare status code when available.
async function parseResponse(response) {
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (body && body.error) message = body.error;
        } catch {
            // Non-JSON error body; keep the status code message
        }
        throw new Error(message);
    }
    return response.json();
}

export class APIClient {
    static async get(url) {
        const response = await fetch(url);
        return parseResponse(response);
    }

    static async post(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return parseResponse(response);
    }

    static async put(url, data) {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return parseResponse(response);
    }

    static async delete(url) {
        const response = await fetch(url, { method: 'DELETE' });
        return parseResponse(response);
    }

    static async deleteWithBody(url, data) {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return parseResponse(response);
    }
}
