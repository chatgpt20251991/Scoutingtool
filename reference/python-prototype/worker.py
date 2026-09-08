"""Run ONE queued import and exit. No autonomous external requests or spending."""
import argparse
import json
from pathlib import Path
import scout

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--db',default=str(Path(__file__).parent/'data'/'scout.sqlite'))
    args=p.parse_args()
    scout.init_db(args.db)
    print(json.dumps(scout.run_worker_once(args.db),ensure_ascii=False))
