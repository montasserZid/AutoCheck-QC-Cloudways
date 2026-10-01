<?php
/**
 * AutoCheck extraction worker gateway (Cloudways).
 *
 * This file is a deliberately thin HTTPS front door for the local Node worker.
 * It performs NO extraction, NO proxying of caller-supplied destinations and
 * NO authentication of its own: the shared worker secret is forwarded to the
 * worker, which is the single place that verifies it in constant time. That
 * keeps exactly one copy of the secret on this host.
 *
 * Deployment target:
 *   /home/master/applications/mwgyfxvkun/public_html/worker-gateway.php
 *
 * Endpoints:
 *   GET  worker-gateway.php?route=health
 *   POST worker-gateway.php?route=extract
 *
 * The backend address is a constant. A caller can never influence it.
 */

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

const AUTOCHECK_WORKER_HOST = '127.0.0.1';
const AUTOCHECK_WORKER_PORT = 3000;
const AUTOCHECK_WORKER_CONNECT_TIMEOUT_S = 3;
const AUTOCHECK_WORKER_TIMEOUT_S = 45;
const AUTOCHECK_WORKER_MAX_BODY_BYTES = 8192;
const AUTOCHECK_WORKER_MAX_RESPONSE_BYTES = 4194304;

/** Worker statuses that may be forwarded verbatim to the caller. */
const AUTOCHECK_FORWARDED_STATUSES = [200, 400, 405, 413, 415, 429, 500, 502, 503];

function autocheck_respond(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function autocheck_fail(int $status, string $code, string $error): void
{
    autocheck_respond($status, ['ok' => false, 'code' => $code, 'error' => $error]);
}

/**
 * Reads the presented worker credential from the inbound request. Both header
 * forms are accepted because some SAPIs drop `Authorization`.
 */
function autocheck_request_headers(): array
{
    $headers = [];
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (is_string($name) && is_string($value)) {
                $headers[strtolower($name)] = $value;
            }
        }
    }
    foreach ($_SERVER as $name => $value) {
        if (strpos((string) $name, 'HTTP_') !== 0 || !is_string($value)) {
            continue;
        }
        $key = strtolower(str_replace('_', '-', substr((string) $name, 5)));
        if (!isset($headers[$key])) {
            $headers[$key] = $value;
        }
    }
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
        if (isset($headers['authorization']) || !isset($_SERVER[$serverKey]) || !is_string($_SERVER[$serverKey])) {
            continue;
        }
        $headers['authorization'] = $_SERVER[$serverKey];
    }
    return $headers;
}

function autocheck_forwarded_credentials(array $headers): array
{
    $forwarded = [];
    foreach (['authorization', 'x-autocheck-worker-secret'] as $name) {
        if (!isset($headers[$name]) || !is_string($headers[$name])) {
            continue;
        }
        $value = trim($headers[$name]);
        // Only forward a plain credential token. Rejecting control characters
        // prevents a caller-supplied value from injecting extra request headers
        // into the worker's request.
        if ($value === '' || !preg_match('/^[\x20-\x7E]+$/', $value)) {
            continue;
        }
        $forwarded[] = $name . ': ' . $value;
    }
    return $forwarded;
}

function autocheck_method(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

function autocheck_read_body(int $maxBytes): string
{
    $declared = $_SERVER['CONTENT_LENGTH'] ?? null;
    if ($declared !== null && is_string($declared) && ctype_digit($declared) && (int) $declared > $maxBytes) {
        autocheck_fail(413, 'REQUEST_TOO_LARGE', 'The extraction request is too large.');
    }
    $body = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($body === false) {
        autocheck_fail(400, 'UNREADABLE_REQUEST', 'The extraction request could not be read.');
    }
    if (strlen($body) > $maxBytes) {
        autocheck_fail(413, 'REQUEST_TOO_LARGE', 'The extraction request is too large.');
    }
    return $body;
}

/**
 * Forwards one request to the fixed local worker and relays its JSON status.
 * Transport failures never leak hostnames, ports or cURL diagnostics.
 */
function autocheck_proxy(string $method, string $workerPath, ?string $body, array $requestHeaders): void
{
    if (!function_exists('curl_init')) {
        autocheck_fail(502, 'WORKER_UNREACHABLE', 'The listing reader is unavailable.');
    }

    $credentials = autocheck_forwarded_credentials($requestHeaders);
    if (count($credentials) === 0) {
        // Let the worker produce the canonical 401 so the response shape matches
        // a direct worker call. No secret is disclosed or guessed here.
        autocheck_fail(401, 'UNAUTHORIZED', 'Worker authentication is required.');
    }

    $requestHeadersOut = ['Accept: application/json'];
    foreach ($credentials as $header) {
        $requestHeadersOut[] = $header;
    }
    if ($body !== null) {
        $requestHeadersOut[] = 'Content-Type: application/json';
        $requestHeadersOut[] = 'Expect:';
    }

    $responseBody = '';
    $responseTruncated = false;
    $handle = curl_init('http://' . AUTOCHECK_WORKER_HOST . ':' . AUTOCHECK_WORKER_PORT . $workerPath);
    if ($handle === false) {
        autocheck_fail(502, 'WORKER_UNREACHABLE', 'The listing reader is unavailable.');
    }

    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_CONNECTTIMEOUT => AUTOCHECK_WORKER_CONNECT_TIMEOUT_S,
        CURLOPT_TIMEOUT => AUTOCHECK_WORKER_TIMEOUT_S,
        CURLOPT_NOSIGNAL => true,
        CURLOPT_HTTPHEADER => $requestHeadersOut,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_WRITEFUNCTION => static function ($resource, $chunk) use (&$responseBody, &$responseTruncated) {
            if ($responseTruncated) {
                return 0;
            }
            $length = strlen($chunk);
            if (strlen($responseBody) + $length > AUTOCHECK_WORKER_MAX_RESPONSE_BYTES) {
                $responseTruncated = true;
                return 0;
            }
            $responseBody .= $chunk;
            return $length;
        },
    ]);
    if ($body !== null) {
        curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    }

    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $transportFailed = curl_errno($handle) !== 0;
    curl_close($handle);

    if ($responseTruncated) {
        autocheck_fail(502, 'WORKER_RESPONSE_TOO_LARGE', 'The listing reader response was too large.');
    }
    if ($transportFailed || $status === 0) {
        autocheck_fail(502, 'WORKER_UNREACHABLE', 'The listing reader is unavailable.');
    }
    if (!in_array($status, AUTOCHECK_FORWARDED_STATUSES, true)) {
        autocheck_fail(502, 'WORKER_ERROR', 'The listing reader failed.');
    }

    $decoded = json_decode($responseBody, true);
    if (!is_array($decoded) || !array_key_exists('ok', $decoded)) {
        autocheck_fail(502, 'WORKER_ERROR', 'The listing reader returned an unexpected response.');
    }

    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    if ($status === 429) {
        header('Retry-After: 10');
    }
    echo json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$route = isset($_GET['route']) && is_string($_GET['route']) ? strtolower(trim($_GET['route'])) : '';
$method = autocheck_method();
$requestHeaders = autocheck_request_headers();

if ($route === 'health') {
    if ($method !== 'GET') {
        header('Allow: GET');
        autocheck_fail(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    }
    autocheck_proxy('GET', '/health', null, $requestHeaders);
}

if ($route === 'extract') {
    if ($method !== 'POST') {
        header('Allow: POST');
        autocheck_fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
    }
    $body = autocheck_read_body(AUTOCHECK_WORKER_MAX_BODY_BYTES);
    autocheck_proxy('POST', '/extract', $body, $requestHeaders);
}

autocheck_fail(404, 'NOT_FOUND', 'Unknown gateway route.');
