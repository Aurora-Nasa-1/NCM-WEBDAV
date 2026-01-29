#!/bin/bash

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Auto update
if [ -d .git ]; then
    echo "Checking for updates..."
    # Avoid conflict with package-lock.json
    git checkout package-lock.json 2>/dev/null
    git pull
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "node_modules not found, installing dependencies..."
    npm install
fi

# Get port from config
PORT=$(grep -oP '"port":\s*\K\d+' webdav_config.json 2>/dev/null || echo 3001)

# Get local IP address
IP_ADDR=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}' || ip addr show | grep -w inet | grep -v 127.0.0.1 | awk '{print $2}' | cut -d/ -f1 | head -n1)

# Start the WebDAV server
echo "---------------------------------------------------"
echo "WebDAV server is starting..."
if [ ! -z "$IP_ADDR" ]; then
    echo "Local Access: http://localhost:$PORT"
    echo "Network Access: http://$IP_ADDR:$PORT"
fi
echo "---------------------------------------------------"
node webdav.js
