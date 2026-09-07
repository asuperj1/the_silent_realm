{
  "targets": [
    {
      "target_name": "battle_engine",
      "sources": [
        "battle_engine.cc",
        "ecs/entity.cc",
        "ecs/event_bus.cc",
        "ecs/system_factory.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags": ["-O3"],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "Optimization": 2,
              "AdditionalOptions": ["/utf-8"]
            }
          }
        }]
      ]
    }
  ]
}
