// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#define TAC_MONO_API(F) \
 F(void*,mono_get_root_domain,(void)) \
 F(void*,mono_thread_attach,(void*)) \
 F(void,mono_thread_detach,(void*)) \
 F(void*,mono_domain_assembly_open,(void*,const char*)) \
 F(void*,mono_assembly_get_image,(void*)) \
 F(void*,mono_class_from_name,(void*,const char*,const char*)) \
 F(void*,mono_class_get_parent,(void*)) \
 F(void*,mono_class_get_method_from_name,(void*,const char*,int)) \
 F(void*,mono_class_get_methods,(void*,void**)) \
 F(const char*,mono_method_get_name,(void*)) \
 F(uint32_t,mono_method_get_flags,(void*,uint32_t*)) \
 F(void*,mono_method_signature,(void*)) \
 F(uint32_t,mono_signature_get_param_count,(void*)) \
 F(void*,mono_signature_get_return_type,(void*)) \
 F(void*,mono_signature_get_params,(void*,void**)) \
 F(int,mono_type_get_type,(void*)) \
 F(void*,mono_class_from_mono_type,(void*)) \
 F(int,mono_class_value_size,(void*,uint32_t*)) \
 F(int,mono_class_is_valuetype,(void*)) \
 F(int,mono_class_is_enum,(void*)) \
 F(void*,mono_class_enum_basetype,(void*)) \
 F(void*,mono_class_get_field_from_name,(void*,const char*)) \
 F(uint32_t,mono_field_get_offset,(void*)) \
 F(void*,mono_field_get_type,(void*)) \
 F(void*,mono_class_get_property_from_name,(void*,const char*)) \
 F(void*,mono_property_get_get_method,(void*)) \
 F(void*,mono_property_get_set_method,(void*)) \
 F(void*,mono_runtime_invoke,(void*,void*,void**,void**)) \
 F(void*,mono_string_new,(void*,const char*)) \
 F(void*,mono_object_new,(void*,void*)) \
 F(void*,mono_object_unbox,(void*)) \
 F(uint32_t,mono_gchandle_new,(void*,int)) \
 F(void*,mono_gchandle_get_target,(uint32_t)) \
 F(void,mono_gchandle_free,(uint32_t)) \
 F(void*,mono_compile_method,(void*))
#define DECLARE(ret,name,args) ret (*name) args;
typedef struct { TAC_MONO_API(DECLARE) } TacMono;
#undef DECLARE
int tac_mono_load(TacMono* api);
