#/bin/bash

rsync -avzh --delete \
	--exclude "*.sh" \
	--exclude "module.json" \
	* /Users/rhead/foundrydata/Data/modules/elevatedvision/ 
