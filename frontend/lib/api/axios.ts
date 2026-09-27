import axios from "axios";
import Cookies from "js-cookie";

// const API_BASE_URL =
//   process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://stock-flow-tnwn.onrender.com";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: false,
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
});

api.interceptors.request.use((config) => {
  // A FormData body must not keep the JSON content type above. axios merges the
  // instance defaults into every request, so passing `{}` per call does not
  // clear it -- and when axios sees FormData with a JSON content type it
  // flattens it back to JSON (axios.cjs: `hasJSONContentType ? JSON.stringify(
  // formDataToJSON(data)) : data`). Every File then serialises to `{}` and the
  // API's FileField answers "The submitted data was not a file."
  // Deleting the header lets the browser send multipart/form-data itself, with
  // the boundary it needs.
  if (config.data instanceof FormData) {
    if (typeof config.headers.delete === "function") {
      config.headers.delete("Content-Type");
    } else {
      delete config.headers["Content-Type"];
    }
  }

  if (typeof window !== "undefined") {
    const accessToken = Cookies.get("token");

    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
  }

  return config;
});
