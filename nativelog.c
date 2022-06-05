#include <stdlib.h>
#include <unistd.h>
#include <assert.h>

#include <node_api.h>

// All these assertions are ugly and will crash V8 if the exported function is
// called with the wrong arguments, but it's not a public interface so that's OK
static napi_value Print(napi_env env, napi_callback_info info) {
  napi_status status;
  napi_value message;
  napi_value result;
  size_t argc = 1;
  size_t length;

  status = napi_get_cb_info(env, info, &argc, &message, NULL, NULL);
  assert(status == napi_ok);

  status = napi_get_value_string_utf8(env, message, NULL, 0, &length);
  assert(status == napi_ok);

  status = napi_create_uint32(env, length, &result);
  assert(status == napi_ok);

  char *bytes = malloc(length + 2);  // +2 is \n and the null terminator
  status = napi_get_value_string_utf8(env, message, bytes, length + 2, &length);
  assert(status == napi_ok);

  bytes[length] = '\n';
  bytes[length + 1] = '\0';
  write(1, bytes, length + 1);
  free(bytes);

  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descs[2] = {
    { "print", 0, Print, 0, 0, 0, napi_default, 0 }
  };
  napi_status status = napi_define_properties(env, exports, 1, descs);
  assert(status == napi_ok);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
