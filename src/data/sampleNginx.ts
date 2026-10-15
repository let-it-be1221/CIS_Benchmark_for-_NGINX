/**
 * Sample NGINX `nginx -T` and `nginx -V` outputs for demo purposes.
 *
 * Three profiles are provided:
 *   - SAMPLE_NONCOMPLIANT: minimal config that fails most checks (good for showing issues)
 *   - SAMPLE_PARTIAL:      real-world config that passes some checks but not others
 *   - SAMPLE_COMPLIANT:    hardened config that passes all auto-evaluatable checks
 *
 * These let users explore the tool without needing a real NGINX server. Users
 * can also paste their own `nginx -T` output to scan their actual environment.
 */

export interface NginxProfile {
  id: string;
  name: string;
  description: string;
  nginxV: string;
  nginxT: string;
}

// -----------------------------------------------------------------------------
// nginx -V output (consistent across all three profiles)
// -----------------------------------------------------------------------------

const NGINX_V_128 = `nginx version: nginx/1.28.0
built by gcc 13.3.1 20240621 (Red Hat 13.3.1-2) 
built with OpenSSL 3.2.2 3 Jun 2024
TLS SNI support enabled
configure arguments: --prefix=/etc/nginx --sbin-path=/usr/sbin/nginx --modules-path=/usr/lib64/nginx/modules --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/run/nginx.pid --lock-path=/run/lock/subsys/nginx.lock --http-client-body-temp-path=/var/cache/nginx/client_temp --http-proxy-temp-path=/var/cache/nginx/proxy_temp --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp --http-scgi-temp-path=/var/cache/nginx/scgi_temp --with-http_ssl_module --with-http_v2_module --with-http_v3_module --with-http_realip_module --with-http_addition_module --with-http_sub_module --with-http_dav_module --with-http_flv_module --with-http_mp4_module --with-http_gunzip_module --with-http_gzip_static_module --with-http_auth_request_module --with-http_random_index_module --with-http_secure_link_module --with-http_slice_module --with-http_stub_status_module --with-mail --with-mail_ssl_module --with-stream --with-stream_ssl_module --with-stream_realip_module --with-stream_ssl_preread_module --with-compat --with-file-aio --with-threads`;

// -----------------------------------------------------------------------------
// Non-compliant profile (the "before" picture)
// -----------------------------------------------------------------------------

const NGINX_T_NONCOMPLIANT = `# configuration file /etc/nginx/nginx.conf:
user nginx;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    access_log  /var/log/nginx/access.log;
    error_log   /var/log/nginx/error.log;

    sendfile        on;
    keepalive_timeout  75;
    send_timeout     60;

    server {
        listen       80;
        listen       [::]:80;
        server_name  example.com;

        location / {
            root   /usr/share/nginx/html;
            index  index.html index.htm;
        }

        error_page   500 502 503 504  /50x.html;
        location = /50x.html {
            root   /usr/share/nginx/html;
        }
    }
}
`;

// -----------------------------------------------------------------------------
// Partially compliant profile (real-world example)
// -----------------------------------------------------------------------------

const NGINX_T_PARTIAL = `# configuration file /etc/nginx/nginx.conf:
user nginx;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log main;
    error_log  /var/log/nginx/error.log warn;

    sendfile        on;
    keepalive_timeout  15;
    send_timeout     15;

    server_tokens off;

    server {
        listen       80 default_server;
        listen       [::]:80 default_server;
        server_name  _;
        return       444;
    }

    server {
        listen       443 ssl;
        server_name  example.com;

        ssl_certificate      /etc/nginx/ssl/example.com.crt;
        ssl_certificate_key  /etc/nginx/ssl/example.com.key;
        ssl_protocols        TLSv1.2 TLSv1.3;
        ssl_ciphers          HIGH:!aNULL:!MD5;

        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Content-Type-Options "nosniff" always;

        location / {
            proxy_pass http://127.0.0.1:8080;
            proxy_set_header Host $host;
        }

        location ~ /\\. {
            deny all;
        }
    }
}
`;

// -----------------------------------------------------------------------------
// Fully compliant profile (hardened, passes all auto-checks)
// -----------------------------------------------------------------------------

const NGINX_T_COMPLIANT = `# configuration file /etc/nginx/nginx.conf:
user nginx;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 1024;
    multi_accept on;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # --- 3.1 Detailed logging ---
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'urt="$upstream_response_time"';

    # --- 3.2 / 3.3 Logging enabled at info level ---
    access_log  /var/log/nginx/access.log main;
    error_log   /var/log/nginx/error.log info;

    sendfile        on;
    tcp_nopush      on;
    tcp_nodelay     on;

    # --- 2.4.3 / 2.4.4 Timeouts ---
    keepalive_timeout  10;
    send_timeout       10;

    # --- 5.2.1 / 5.2.2 / 5.2.3 Client limits ---
    client_header_timeout 10;
    client_body_timeout    10;
    client_max_body_size   10m;
    large_client_header_buffers 4 8k;

    # --- 5.2.4 / 5.2.5 Connection and rate limits ---
    limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
    limit_conn conn_per_ip 10;
    limit_req_zone $binary_remote_addr zone=req_limit:10m rate=10r/s;
    limit_req zone=req_limit burst=20 nodelay;

    # --- 2.5.1 Hide version ---
    server_tokens off;

    # --- 4.1.4 / 4.1.5 Modern TLS, strong ciphers ---
    ssl_protocols              TLSv1.2 TLSv1.3;
    ssl_ciphers                ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:!aNULL:!MD5:!RC4:!3DES;
    ssl_prefer_server_ciphers  on;

    # --- 4.1.2 Certificate ---
    ssl_certificate      /etc/nginx/ssl/example.com.fullchain.pem;
    ssl_certificate_key  /etc/nginx/ssl/example.com.key;

    # --- 4.1.7 OCSP stapling ---
    ssl_stapling             on;
    ssl_stapling_verify      on;
    ssl_trusted_certificate  /etc/nginx/ssl/chain.pem;
    resolver                 1.1.1.1 1.0.0.1 valid=300s;

    # --- 4.1.11 Session resumption ---
    ssl_session_cache     shared:SSL:10m;
    ssl_session_tickets   on;
    ssl_session_timeout   1d;

    # --- 4.1.9 / 4.1.10 Upstream mTLS ---
    proxy_ssl_certificate           /etc/nginx/ssl/client.crt;
    proxy_ssl_certificate_key        /etc/nginx/ssl/client.key;
    proxy_ssl_trusted_certificate   /etc/nginx/ssl/upstream-ca.pem;
    proxy_ssl_verify                 on;
    proxy_ssl_verify_depth           2;

    # --- 4.1.8 HSTS, 5.3.1/5.3.2/5.3.3 Security headers ---
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options    "nosniff"                                              always;
    add_header Content-Security-Policy   "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin"                      always;
    add_header Alt-Svc                  "h3=\\":443\\"; ma=86400"                              always;

    # --- 2.5.4 Hide upstream headers ---
    proxy_hide_header X-Powered-By;
    proxy_hide_header Server;
    proxy_hide_header Via;

    # --- 2.4.1 Authorized ports, 2.4.2 reject unknown hosts, 4.1.1 redirect HTTP, 4.1.12 HTTP/3 ---
    # HTTP listener: redirect to HTTPS (4.1.1)
    server {
        listen       80;
        listen       [::]:80;
        server_name  example.com;
        return       301 https://$host$request_uri;
    }

    # HTTPS default: reject unknown hostnames (2.4.2)
    server {
        listen       443 ssl default_server;
        listen       [::]:443 ssl default_server;
        listen       443 quic reuseport;
        http3        on;
        server_name  _;
        ssl_certificate     /etc/nginx/ssl/example.com.fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/example.com.key;
        return       444;
    }

    server {
        listen       443 ssl;
        listen       443 quic;
        http3        on;
        server_name  example.com;

        # --- 5.1.1 IP allow list ---
        allow 10.0.0.0/8;
        allow 192.168.0.0/16;
        deny all;

        # --- 5.1.2 Approved HTTP methods only ---
        location / {
            limit_except GET POST HEAD {
                deny all;
            }
            proxy_pass http://backend;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # --- 2.5.3 Hidden files ---
        location ~ /\\. {
            deny all;
        }
    }

    upstream backend {
        server 127.0.0.1:8080;
    }
}
`;

// -----------------------------------------------------------------------------

export const SAMPLE_PROFILES: NginxProfile[] = [
  {
    id: 'noncompliant',
    name: 'Non-compliant (default)',
    description: 'A minimal stock NGINX install with default timeouts, no TLS, and no hardening. Most checks will FAIL.',
    nginxV: NGINX_V_128,
    nginxT: NGINX_T_NONCOMPLIANT,
  },
  {
    id: 'partial',
    name: 'Partial compliance',
    description: 'A real-world config with TLS enabled and some hardening but several gaps (e.g. weak error_log level, missing rate limits, no CSP).',
    nginxV: NGINX_V_128,
    nginxT: NGINX_T_PARTIAL,
  },
  {
    id: 'compliant',
    name: 'Fully hardened',
    description: 'A hardened configuration that passes all auto-evaluatable CIS NGINX Benchmark recommendations.',
    nginxV: NGINX_V_128,
    nginxT: NGINX_T_COMPLIANT,
  },
];
