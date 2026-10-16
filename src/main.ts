import "./ui/hud.css";
import { App } from "./app/app";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const ui = document.querySelector<HTMLDivElement>("#ui");
if (!canvas || !ui) throw new Error("Missing #scene canvas or #ui root");

const app = new App(canvas, ui);
app.start();
