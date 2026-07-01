UPDATE user_inference_settings
SET default_model_id = 'verxio-qwen'
WHERE default_model_id != 'verxio-qwen';
