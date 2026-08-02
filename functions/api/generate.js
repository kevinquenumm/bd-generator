// functions/api/generate.js
//
// Cloudflare Pages Function — proxy vers l'API OpenAI (images).
// Route exposée : POST /api/generate

const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { success: false, error: "OPENAI_API_KEY manquant côté serveur (variable d'environnement Cloudflare Pages non configurée)." },
      500
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return jsonResponse({ success: false, error: "Requête invalide : impossible de lire le formulaire." }, 400);
  }

  const prompt = (form.get("prompt") || "").toString().trim();
  if (!prompt) {
    return jsonResponse({ success: false, error: "Le prompt est vide." }, 400);
  }

  const model = (form.get("model") || "gpt-image-1").toString();
  const size = (form.get("size") || "1024x1536").toString();
  const quality = (form.get("quality") || "high").toString();
  const inputFidelity = (form.get("input_fidelity") || "high").toString();

  const images = form.getAll("image[]").filter((f) => f && typeof f.arrayBuffer === "function" && f.size > 0);

  try {
    let openaiResponse;
    const isGptImage = model.startsWith("gpt-image");

    if (images.length > 0) {
      const upstream = new FormData();
      upstream.append("model", model);
      upstream.append("prompt", prompt);
      upstream.append("size", size);
      upstream.append("n", "1");
      if (isGptImage) {
        upstream.append("quality", quality);
        upstream.append("input_fidelity", inputFidelity);
      } else {
        upstream.append("response_format", "b64_json");
      }
      for (const file of images) {
        upstream.append("image[]", file, file.name || "reference.png");
      }
      openaiResponse = await fetch(OPENAI_EDITS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream,
      });
    } else {
      const body = { model, prompt, size, n: 1 };
      if (isGptImage) {
        body.quality = quality;
      } else {
        body.response_format = "b64_json";
      }
      openaiResponse = await fetch(OPENAI_GENERATIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    const raw = await openaiResponse.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return jsonResponse(
        { success: false, error: `Réponse OpenAI illisible (HTTP ${openaiResponse.status}).` },
        502
      );
    }

    if (!openaiResponse.ok) {
      const message = (data && data.error && data.error.message) || `Erreur OpenAI (HTTP ${openaiResponse.status}).`;
      return jsonResponse({ success: false, error: message }, openaiResponse.status);
    }

    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) {
      return jsonResponse({ success: false, error: "Réponse OpenAI sans image (b64_json manquant)." }, 502);
    }

    return jsonResponse({ success: true, b64 });
  } catch (err) {
    return jsonResponse({ success: false, error: `Erreur réseau côté serveur : ${err.message || err}` }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Utilisez POST pour générer une image." }, 405);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
