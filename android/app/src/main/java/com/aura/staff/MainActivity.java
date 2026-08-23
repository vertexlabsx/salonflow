package com.aura.staff;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.RequiresApi;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    @Override
    @SuppressLint("NewApi")
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AttendanceBiometricPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        WebViewClient original = webView.getWebViewClient();
        if (original == null) return;

        webView.setWebViewClient(new DelegatingWebViewClient(original));
    }

    private static boolean isApiUrl(String url) {
        return url != null && url.contains("aurashinesalonwellness.in");
    }

    private static WebResourceResponse corsPreflightResponse() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://localhost");
        headers.put("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "*");
        headers.put("Access-Control-Allow-Credentials", "true");
        headers.put("Access-Control-Max-Age", "86400");
        return new WebResourceResponse(
            "text/plain", "utf-8", 200, "OK",
            headers, new ByteArrayInputStream(new byte[0])
        );
    }

    private static class DelegatingWebViewClient extends WebViewClient {
        private final WebViewClient delegate;

        DelegatingWebViewClient(WebViewClient delegate) {
            this.delegate = delegate;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            String method = request.getMethod();
            if ("OPTIONS".equalsIgnoreCase(method) && isApiUrl(url)) {
                return corsPreflightResponse();
            }
            try { return delegate.shouldInterceptRequest(view, request); } catch (Exception e) { }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            try { return delegate.shouldInterceptRequest(view, url); } catch (Exception e) { }
            return super.shouldInterceptRequest(view, url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            try { return delegate.shouldOverrideUrlLoading(view, url); } catch (Exception e) { }
            return super.shouldOverrideUrlLoading(view, url);
        }

        @Override
        @RequiresApi(api = Build.VERSION_CODES.N)
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            try { return delegate.shouldOverrideUrlLoading(view, request); } catch (Exception e) { }
            return super.shouldOverrideUrlLoading(view, request);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            try { delegate.onPageStarted(view, url, favicon); } catch (Exception e) { }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            try { delegate.onPageFinished(view, url); } catch (Exception e) { }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            try { delegate.onReceivedError(view, request, error); } catch (Exception e) { }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            try { delegate.onReceivedError(view, errorCode, description, failingUrl); } catch (Exception e) { }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            try { delegate.onReceivedHttpError(view, request, errorResponse); } catch (Exception e) { }
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            try { delegate.doUpdateVisitedHistory(view, url, isReload); } catch (Exception e) { }
        }

        @Override
        public void onScaleChanged(WebView view, float oldScale, float newScale) {
            try { delegate.onScaleChanged(view, oldScale, newScale); } catch (Exception e) { }
        }

        @Override
        public void onLoadResource(WebView view, String url) {
            try { delegate.onLoadResource(view, url); } catch (Exception e) { }
        }
    }
}
