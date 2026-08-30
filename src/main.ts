import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, RouteReuseStrategy } from "@angular/router";
import { IonicRouteStrategy, provideIonicAngular } from "@ionic/angular/standalone";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";
import { csrfInterceptor } from "./app/core/csrf.interceptor";

const savedTheme = localStorage.getItem("auraStaffTheme");
const initialTheme = savedTheme === "dark" || savedTheme === "light"
  ? savedTheme
  : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset["staffTheme"] = initialTheme;
document.documentElement.style.colorScheme = initialTheme;
document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", initialTheme === "dark" ? "#2A1433" : "#7B2F62");

bootstrapApplication(AppComponent, {
  providers: [
    provideIonicAngular(),
    provideHttpClient(withInterceptors([csrfInterceptor])),
    provideRouter(routes),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy }
  ]
}).catch((error) => console.error(error));
