import sys
import os
from huggingface_hub import batch_bucket_files


def main():
    if len(sys.argv) < 2:
        print('ERROR: No file path provided.')
        sys.exit(1)

    file_path   = sys.argv[1]
    token       = os.getenv('HF_TOKEN')
    bucket_name = os.getenv('HF_BUCKET_NAME')

    try:
        batch_bucket_files(
            bucket_id=bucket_name,
            token=token,
            delete=[file_path],
        )
        print(f'SUCCESS: Deleted {file_path}')
    except Exception as e:
        print(f'ERROR: {e}')
        sys.exit(1)


if __name__ == '__main__':
    main()