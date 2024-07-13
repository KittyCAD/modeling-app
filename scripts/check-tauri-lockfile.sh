DIR=src-tauri
cd $DIR
if cargo check --locked ; then
    echo "Seems $DIR/Cargo.lock is up to date."
else
    echo "Pls run cargo check and commit the changed $DIR/Cargo.lock, because it's out of date."
fi
cd -
