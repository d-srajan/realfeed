const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'content/content-script': './extension/content/content-script.js',
    'background/service-worker': './extension/background/service-worker.js',
    'popup/popup': './extension/popup/popup.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        type: 'javascript/auto',
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'extension/manifest.json', to: 'manifest.json' },
        { from: 'extension/popup/popup.html', to: 'popup/popup.html' },
        { from: 'extension/popup/popup.css', to: 'popup/popup.css' },
        { from: 'extension/icons', to: 'icons', noErrorOnMissing: true },
        { from: 'extension/models', to: 'models', noErrorOnMissing: true },
        // ONNX Runtime WASM files — must be accessible by the service worker at runtime
        {
          from: 'node_modules/onnxruntime-web/dist/*.wasm',
          to: 'lib/[name][ext]',
        },
        {
          from: 'node_modules/onnxruntime-web/dist/*.mjs',
          to: 'lib/[name][ext]',
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js', '.mjs'],
  },
  experiments: {
    asyncWebAssembly: true,
  },
  devtool: 'cheap-module-source-map',
};
